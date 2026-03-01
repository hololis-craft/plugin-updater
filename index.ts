#!/usr/bin/env bun
import { parse } from "yaml";
import SftpClient, { type ConnectOptions } from "ssh2-sftp-client";
import { mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";

const LOADER_PREFERENCE = ["paper", "purpur", "bukkit", "spigot"];

// Zodスキーマ定義
const ModrinthPluginSchema = z.object({
  name: z.string(),
  source: z.literal("modrinth"),
  project_id: z.string(),
  version: z.string().optional(),
  game_version_check: z.boolean().default(true),
});

const SpigotPluginSchema = z.object({
  name: z.string(),
  source: z.literal("spigot"),
  resource_id: z.string(),
});

const UrlPluginSchema = z.object({
  name: z.string(),
  source: z.literal("url"),
  url: z.string().url(),
  filename: z.string().optional(),
});

const GitHubPluginSchema = z.object({
  name: z.string(),
  source: z.literal("github"),
  repo: z.string(),
  tag: z.string().optional(),
  asset_pattern: z.string().optional(),
  filename: z.string().optional(),
});

const PluginSchema = z.discriminatedUnion("source", [
  ModrinthPluginSchema,
  SpigotPluginSchema,
  UrlPluginSchema,
  GitHubPluginSchema,
]);

const SftpConfigSchema = z.object({
  host: z.string(),
  port: z.number().int().positive(),
  username: z.string(),
  password: z.string().optional(),
  private_key_path: z.string().optional(),
  remote_path: z.string(),
});

const CleanupConfigSchema = z.object({
  enabled: z.boolean(),
  keep_patterns: z.array(z.string()).optional(),
});

const ConfigSchema = z.object({
  loader_preference: z.array(z.string()).default(LOADER_PREFERENCE),
  minecraft_version: z.string(),
  download_dir: z.string(),
  plugins: z.array(PluginSchema),
  sftp: SftpConfigSchema,
  cleanup: CleanupConfigSchema.optional(),
});

// Zodスキーマから型を推論
type ModrinthPlugin = z.infer<typeof ModrinthPluginSchema>;
type SpigotPlugin = z.infer<typeof SpigotPluginSchema>;
type UrlPlugin = z.infer<typeof UrlPluginSchema>;
type GitHubPlugin = z.infer<typeof GitHubPluginSchema>;
type SftpConfig = z.infer<typeof SftpConfigSchema>;
type CleanupConfig = z.infer<typeof CleanupConfigSchema>;

// Modrinth API レスポンス型
interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
  file_type: string | null;
}

interface ModrinthVersion {
  id: string;
  project_id: string;
  version_number: string;
  version_type: string;
  game_versions: string[];
  loaders: string[];
  files: ModrinthVersionFile[];
  dependencies: unknown[];
  date_published: string;
}

// GitHub API レスポンス型
interface GitHubReleaseAsset {
  id: number;
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubReleaseAsset[];
  published_at: string;
}

// Spiget API レスポンス型
interface SpigetResource {
  id: number;
  name: string;
  tag: string;
  version: {
    id: number;
    uuid: string;
  };
  author: {
    id: number;
  };
  category: {
    id: number;
  };
  rating: {
    count: number;
    average: number;
  };
  releaseDate: number;
  updateDate: number;
  downloads: number;
  external: boolean;
  file: {
    type: string;
    size: number;
    sizeUnit: string;
    url: string;
  };
  testedVersions: string[];
  links: {
    discussion: string;
    updates: string;
  };
}

// Modrinth APIからプラグインをダウンロード
async function downloadFromModrinth(
  plugin: ModrinthPlugin,
  minecraftVersion: string,
  loaderPreference: string[],
  downloadDir: string,
): Promise<string | null> {
  console.log(`📦 Modrinth: ${plugin.name}をダウンロード中...`);

  try {
    // バージョン一覧を取得
    const versionsUrl = `https://api.modrinth.com/v2/project/${plugin.project_id}/version`;
    const versionsRes = await fetch(versionsUrl);

    if (!versionsRes.ok) {
      console.error(`❌ ${plugin.name} のバージョン情報を取得できません`);
      return null;
    }

    const versions = (await versionsRes.json()) as ModrinthVersion[];

    // 適合するバージョンを検索
    const filterPredicate = (v: ModrinthVersion) => {
      if (plugin.version) {
        return v.version_number === plugin.version;
      }
      if (plugin.game_version_check) {
        return v.game_versions.includes(minecraftVersion);
      }

      return true;
    };

    // LOADER_PREFERENCEの順で探す
    let targetVersion: ModrinthVersion | undefined;
    for (const loader of loaderPreference) {
      targetVersion = versions.find(
        (v) => filterPredicate(v) && v.loaders.includes(loader),
      );
      if (targetVersion) {
        break;
      }
    }

    if (!targetVersion) {
      console.error(
        `❌ ${plugin.name} の適合バージョンが見つかりません (MC ${minecraftVersion})`,
      );
      return null;
    }

    // ダウンロードファイルを取得（最初のファイル）
    const file = targetVersion.files[0];
    if (!file) {
      console.error(`❌ ${plugin.name} のダウンロードファイルが見つかりません`);
      return null;
    }
    const downloadUrl = file.url;
    const filename = file.filename;

    console.log(`   バージョン: ${targetVersion.version_number}`);
    console.log(`   ファイル: ${filename}`);

    // ダウンロード
    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) {
      console.error(`❌ ダウンロード失敗: ${downloadUrl}`);
      return null;
    }

    const buffer = await fileRes.arrayBuffer();
    const filePath = join(downloadDir, filename);

    await Bun.write(filePath, buffer);
    console.log(`✅ ${plugin.name} をダウンロードしました: ${filename}`);

    return filePath;
  } catch (error) {
    console.error(`❌ ${plugin.name} のダウンロードエラー:`, error);
    return null;
  }
}

// Spigot (Spiget API)からプラグインをダウンロード
async function downloadFromSpigot(
  plugin: SpigotPlugin,
  downloadDir: string,
): Promise<string | null> {
  console.log(`📦 Spigot: ${plugin.name}をダウンロード中...`);

  try {
    const resourceId = plugin.resource_id;

    // リソース情報を取得
    const resourceUrl = `https://api.spiget.org/v2/resources/${resourceId}`;
    const resourceRes = await fetch(resourceUrl);

    if (!resourceRes.ok) {
      console.error(`❌ リソース ${plugin.name} が見つかりません`);
      return null;
    }

    const resource = (await resourceRes.json()) as SpigetResource;
    console.log(`   バージョン: ${resource.tag}`);

    // ダウンロード
    const downloadUrl = `https://api.spiget.org/v2/resources/${resourceId}/download`;
    const fileRes = await fetch(downloadUrl, {
      headers: {
        "User-Agent": "PluginUpdater/1.0",
      },
    });

    if (!fileRes.ok) {
      console.error(`❌ ダウンロード失敗: ${downloadUrl}`);
      return null;
    }

    const buffer = await fileRes.arrayBuffer();
    const filename = `${plugin.name}-${resource.version.id}.jar`;
    const filePath = join(downloadDir, filename);

    await Bun.write(filePath, buffer);
    console.log(`✅ ${plugin.name} をダウンロードしました: ${filename}`);

    return filePath;
  } catch (error) {
    console.error(`❌ ${plugin.name} のダウンロードエラー:`, error);
    return null;
  }
}

// URLから直接ダウンロード
async function downloadFromUrl(
  plugin: UrlPlugin,
  downloadDir: string,
): Promise<string | null> {
  console.log(`📦 URL: ${plugin.name}をダウンロード中...`);

  try {
    console.log(`   URL: ${plugin.url}`);

    // ダウンロード
    const fileRes = await fetch(plugin.url, {
      headers: {
        "User-Agent": "PluginUpdater/1.0",
      },
    });

    if (!fileRes.ok) {
      console.error(
        `❌ ダウンロード失敗: ${plugin.url} (${fileRes.status} ${fileRes.statusText})`,
      );
      return null;
    }

    const buffer = await fileRes.arrayBuffer();

    // ファイル名を決定
    let filename: string;
    if (plugin.filename) {
      // 設定で指定されたファイル名を使用
      filename = plugin.filename;
    } else {
      // URLからファイル名を抽出
      const urlPath = new URL(plugin.url).pathname;
      const urlFilename = urlPath.split("/").pop();

      if (urlFilename && urlFilename.endsWith(".jar")) {
        filename = urlFilename;
      } else {
        // ファイル名が取得できない場合はプラグイン名を使用
        filename = `${plugin.name}.jar`;
      }
    }

    console.log(`   ファイル: ${filename}`);

    const filePath = join(downloadDir, filename);
    await Bun.write(filePath, buffer);
    console.log(`✅ ${plugin.name} をダウンロードしました: ${filename}`);

    return filePath;
  } catch (error) {
    console.error(`❌ ${plugin.name} のダウンロードエラー:`, error);
    return null;
  }
}

// GitHub Releasesからダウンロード
async function downloadFromGitHub(
  plugin: GitHubPlugin,
  downloadDir: string,
): Promise<string | null> {
  console.log(`📦 GitHub: ${plugin.name}をダウンロード中...`);

  try {
    const tag = plugin.tag || "latest";
    console.log(`   リポジトリ: ${plugin.repo}`);
    console.log(`   タグ: ${tag}`);

    // GitHub API URLを構築
    let apiUrl: string;
    if (tag === "latest") {
      apiUrl = `https://api.github.com/repos/${plugin.repo}/releases/latest`;
    } else {
      apiUrl = `https://api.github.com/repos/${plugin.repo}/releases/tags/${tag}`;
    }

    // リリース情報を取得
    const headers: Record<string, string> = {
      "User-Agent": "PluginUpdater/1.0",
      Accept: "application/vnd.github+json",
    };

    // GitHubトークンがある場合は追加（レート制限を回避）
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const releaseRes = await fetch(apiUrl, { headers });

    if (!releaseRes.ok) {
      console.error(
        `❌ リリース情報の取得に失敗しました: ${releaseRes.status} ${releaseRes.statusText}`,
      );
      return null;
    }

    const release = (await releaseRes.json()) as GitHubRelease;
    console.log(
      `   リリース: ${release.tag_name} (${release.name || "名前なし"})`,
    );

    // assetsから.jarファイルを検索
    const assetPattern = plugin.asset_pattern
      ? new RegExp(plugin.asset_pattern)
      : /\.jar$/i;

    const jarAsset = release.assets.find((asset) =>
      assetPattern.test(asset.name),
    );

    if (!jarAsset) {
      console.error(
        `❌ .jarファイルが見つかりません（パターン: ${assetPattern}）`,
      );
      console.log(`   利用可能なアセット:`);
      release.assets.forEach((asset) => {
        console.log(`     - ${asset.name}`);
      });
      return null;
    }

    console.log(`   アセット: ${jarAsset.name}`);
    console.log(`   サイズ: ${(jarAsset.size / 1024 / 1024).toFixed(2)} MB`);

    // ダウンロード
    const fileRes = await fetch(jarAsset.browser_download_url, {
      headers: {
        "User-Agent": "PluginUpdater/1.0",
      },
    });

    if (!fileRes.ok) {
      console.error(
        `❌ ダウンロード失敗: ${fileRes.status} ${fileRes.statusText}`,
      );
      return null;
    }

    const buffer = await fileRes.arrayBuffer();

    // ファイル名を決定
    const filename = plugin.filename || jarAsset.name;
    const filePath = join(downloadDir, filename);

    await Bun.write(filePath, buffer);
    console.log(`✅ ${plugin.name} をダウンロードしました: ${filename}`);

    return filePath;
  } catch (error) {
    console.error(`❌ ${plugin.name} のダウンロードエラー:`, error);
    return null;
  }
}

// SFTPでファイルをアップロード
async function uploadToSftp(
  files: string[],
  sftpConfig: SftpConfig,
): Promise<void> {
  console.log("\n🚀 SFTP転送を開始...");

  const sftp = new SftpClient();

  try {
    // 接続設定
    const connectConfig: ConnectOptions = {
      host: sftpConfig.host,
      port: sftpConfig.port,
      username: sftpConfig.username,
    };

    // パスワードまたは秘密鍵
    if (sftpConfig.password) {
      connectConfig.password = sftpConfig.password;
    } else if (sftpConfig.private_key_path) {
      connectConfig.privateKey = await Bun.file(
        sftpConfig.private_key_path,
      ).text();
    }

    // 接続
    await sftp.connect(connectConfig);
    console.log(`✅ ${sftpConfig.host}に接続しました`);

    // リモートディレクトリの存在確認（なければ作成）
    try {
      await sftp.mkdir(sftpConfig.remote_path, true);
    } catch (error) {
      // ディレクトリが既に存在する場合はエラーを無視
    }

    // ファイルをアップロード
    for (const filePath of files) {
      const filename = basename(filePath);
      const remotePath = `${sftpConfig.remote_path}/${filename}`;

      console.log(`📤 ${filename} をアップロード中...`);
      await sftp.put(filePath, remotePath);
      console.log(`✅ ${filename} をアップロードしました`);
    }
  } catch (error) {
    console.error("❌ SFTP転送エラー:", error);
    throw error;
  } finally {
    await sftp.end();
  }
}

// リモートの古いプラグインをクリーンアップ
async function cleanupOldPlugins(
  uploadedFiles: string[],
  sftpConfig: SftpConfig,
  cleanupConfig: CleanupConfig,
): Promise<void> {
  if (!cleanupConfig.enabled) {
    console.log("\n⏭️  クリーンアップはスキップされました");
    return;
  }

  console.log("\n🧹 古いプラグインをクリーンアップ中...");

  const sftp = new SftpClient();

  try {
    // 接続設定
    const connectConfig: ConnectOptions = {
      host: sftpConfig.host,
      port: sftpConfig.port,
      username: sftpConfig.username,
    };

    if (sftpConfig.password) {
      connectConfig.password = sftpConfig.password;
    } else if (sftpConfig.private_key_path) {
      connectConfig.privateKey = await Bun.file(
        sftpConfig.private_key_path,
      ).text();
    }

    await sftp.connect(connectConfig);

    // リモートディレクトリのファイル一覧を取得
    const remoteFiles = await sftp.list(sftpConfig.remote_path);

    // .jarファイルのみをフィルタ
    const jarFiles = remoteFiles.filter(
      (file) => file.type === "-" && file.name.endsWith(".jar"),
    );

    // アップロードしたファイルのベース名を取得
    const uploadedBaseNames = uploadedFiles.map((file) => basename(file));

    // 削除対象のファイルを特定
    const filesToDelete: string[] = [];

    for (const jarFile of jarFiles) {
      const filename = jarFile.name;

      // 新しくアップロードしたファイルはスキップ
      if (uploadedBaseNames.includes(filename)) {
        continue;
      }

      // keep_patternsに一致するファイルはスキップ
      if (cleanupConfig.keep_patterns) {
        const shouldKeep = cleanupConfig.keep_patterns.some((pattern) => {
          const regex = new RegExp(pattern);
          return regex.test(filename);
        });

        if (shouldKeep) {
          console.log(`   保持: ${filename} (パターンに一致)`);
          continue;
        }
      }

      filesToDelete.push(filename);
    }

    // ファイルを削除
    if (filesToDelete.length > 0) {
      console.log(`\n🗑️  ${filesToDelete.length}個の古いプラグインを削除中...`);

      for (const filename of filesToDelete) {
        const remotePath = `${sftpConfig.remote_path}/${filename}`;
        console.log(`   削除: ${filename}`);
        await sftp.delete(remotePath);
      }

      console.log(`✅ ${filesToDelete.length}個のファイルを削除しました`);
    } else {
      console.log("✅ 削除するファイルはありません");
    }
  } catch (error) {
    console.error("❌ クリーンアップエラー:", error);
    throw error;
  } finally {
    await sftp.end();
  }
}

// メイン処理
async function main() {
  console.log("🔧 プラグインアップデーター\n");

  // 設定ファイルを読み込む
  const configPath = process.argv[2] || "plugins.yaml";

  if (!existsSync(configPath)) {
    console.error(`❌ 設定ファイルが見つかりません: ${configPath}`);
    console.log("\n使い方: bun index.ts [config.yaml]");
    console.log("例: bun index.ts plugins.yaml");
    process.exit(1);
  }

  const configText = await Bun.file(configPath).text();
  const parsedYaml = parse(configText);

  // 設定ファイルのバリデーション
  const validationResult = ConfigSchema.safeParse(parsedYaml);

  if (!validationResult.success) {
    console.error("❌ 設定ファイルのバリデーションエラー:\n");
    for (const issue of validationResult.error.issues) {
      console.error(`  • ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  const config = validationResult.data;

  // 環境変数から設定を上書き（オプション）
  if (process.env.SFTP_HOST) config.sftp.host = process.env.SFTP_HOST;
  if (process.env.SFTP_PORT) config.sftp.port = parseInt(process.env.SFTP_PORT);
  if (process.env.SFTP_USERNAME)
    config.sftp.username = process.env.SFTP_USERNAME;
  if (process.env.SFTP_PASSWORD)
    config.sftp.password = process.env.SFTP_PASSWORD;
  if (process.env.SFTP_PRIVATE_KEY_PATH)
    config.sftp.private_key_path = process.env.SFTP_PRIVATE_KEY_PATH;

  console.log(`📋 Minecraftバージョン: ${config.minecraft_version}`);
  console.log(`📁 ダウンロード先: ${config.download_dir}`);
  console.log(`🔌 プラグイン数: ${config.plugins.length}\n`);

  // ダウンロードディレクトリを作成
  if (!existsSync(config.download_dir)) {
    await mkdir(config.download_dir, { recursive: true });
  }

  // プラグインをダウンロード
  const downloadedFiles: string[] = [];

  for (const plugin of config.plugins) {
    let filePath: string | null = null;

    if (plugin.source === "modrinth") {
      filePath = await downloadFromModrinth(
        plugin,
        config.minecraft_version,
        config.loader_preference,
        config.download_dir,
      );
    } else if (plugin.source === "spigot") {
      filePath = await downloadFromSpigot(plugin, config.download_dir);
    } else if (plugin.source === "url") {
      filePath = await downloadFromUrl(plugin, config.download_dir);
    } else if (plugin.source === "github") {
      filePath = await downloadFromGitHub(plugin, config.download_dir);
    } else {
      // Exhaustiveness check
      const _exhaustiveCheck: never = plugin;
      console.error(`❌ 不明なソース`);
      continue;
    }

    if (filePath) {
      downloadedFiles.push(filePath);
    }

    // レート制限を避けるため少し待機
    await Bun.sleep(500);
  }

  console.log(
    `\n✅ ${downloadedFiles.length}個のプラグインをダウンロードしました`,
  );

  // SFTPでアップロード
  if (downloadedFiles.length > 0) {
    try {
      await uploadToSftp(downloadedFiles, config.sftp);

      // クリーンアップ
      if (config.cleanup) {
        await cleanupOldPlugins(downloadedFiles, config.sftp, config.cleanup);
      }

      console.log("\n🎉 すべての処理が完了しました！");
    } catch (error) {
      console.error("\n❌ 処理失敗");
      process.exit(1);
    }
  } else {
    console.log("\n⚠️  アップロードするファイルがありません");
  }
}

// スクリプト実行
main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
