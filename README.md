# plugin-updater

ModrinthとSpigotからYAMLで指定したプラグインの適合するバージョンをダウンロードし、PterodactylにSFTPで転送するBunスクリプトです。

## インストール

```bash
bun install
```

## 設定

### 1. 設定ファイルの作成

`plugins.example.yaml`を参考に、`plugins.yaml`を作成します。

```bash
cp plugins.example.yaml plugins.yaml
```

```yaml
# Minecraftバージョン
minecraft_version: "1.20.1"

# ダウンロード先ディレクトリ
download_dir: "./downloads"

# プラグインリスト
plugins:
  # Spigotからダウンロード
  - name: "EssentialsX"
    source: "spigot"
    resource_id: "9089"

  # Modrinthからダウンロード
  - name: "LuckPerms"
    source: "modrinth"
    project_id: "luckperms"

  # URLから直接ダウンロード
  - name: "CustomPlugin"
    source: "url"
    url: "https://example.com/plugins/CustomPlugin.jar"

  # GitHub Releasesから
  - name: "MyPlugin"
    source: "github"
    repo: "username/repository"
    tag: "latest"

# Pterodactyl SFTP設定
sftp:
  host: "sftp.example.com"
  port: 2022
  username: "your-username"
  password: "your-password"
  remote_path: "/plugins"
```

### 2. 環境変数の設定（オプション）

`.env.example`を参考に、`.env`を作成することもできます。

```bash
cp .env.example .env
```

環境変数を設定すると、YAMLファイルの設定を上書きします。

## 使い方

```bash
bun index.ts [config.yaml]
```

デフォルトでは`plugins.yaml`を読み込みます。

```bash
# デフォルト設定で実行
bun index.ts

# 別の設定ファイルを指定
bun index.ts my-plugins.yaml
```

## 機能

- ✅ Modrinth APIからプラグインをダウンロード
- ✅ Spigot (Spiget API)からプラグインをダウンロード
- ✅ GitHub Releasesから最新版を自動取得
- ✅ 任意のURLから直接ダウンロード
- ✅ Minecraftバージョンに適合するバージョンを自動選択
- ✅ SFTPでPterodactylサーバーに自動転送
- ✅ 古いプラグインの自動クリーンアップ
- ✅ 保持するファイルのパターン指定（正規表現対応）
- ✅ レート制限回避のための待機機能
- ✅ 型安全なTypeScript実装

## プラグインソースの指定方法

### Modrinth

```yaml
- name: "LuckPerms"
  source: "modrinth"
  project_id: "luckperms"  # ModrinthのプロジェクトID
  # version: "5.4.102"  # オプション: 特定バージョンを指定
```

プロジェクトIDは、ModrinthのプラグインページのURLから取得できます。
例: `https://modrinth.com/plugin/luckperms` → `luckperms`

### Spigot

```yaml
- name: "EssentialsX"
  source: "spigot"
  resource_id: "9089"  # SpigotのリソースID
```

リソースIDは、SpigotのプラグインページのURLから取得できます。
例: `https://www.spigotmc.org/resources/essentialsx.9089/` → `9089`

### URL（直接ダウンロード）

任意のURLから直接プラグインをダウンロードできます。

```yaml
- name: "CustomPlugin"
  source: "url"
  url: "https://example.com/plugins/CustomPlugin-1.0.0.jar"
  # filename: "CustomPlugin-1.0.0.jar"  # オプション: ファイル名を指定
```

- `url`: ダウンロードするファイルの直接URL
- `filename`: （オプション）保存するファイル名。省略した場合はURLから自動推測

#### 使用例

```yaml
# GitHub Releasesから
- name: "MyPlugin"
  source: "url"
  url: "https://github.com/user/plugin/releases/download/v1.0.0/MyPlugin-1.0.0.jar"

# Jenkins CIから
- name: "DevPlugin"
  source: "url"
  url: "https://ci.example.com/job/plugin/lastSuccessfulBuild/artifact/target/plugin.jar"
  filename: "DevPlugin-latest.jar"

# その他のホスティングサービスから
- name: "CustomPlugin"
  source: "url"
  url: "https://cdn.example.com/plugins/CustomPlugin.jar"
```

### GitHub Releases

GitHub Releasesから最新版または特定のタグのリリースを自動的にダウンロードできます。

```yaml
- name: "MyPlugin"
  source: "github"
  repo: "username/repository"  # GitHubリポジトリ（owner/repo形式）
  tag: "latest"                # "latest"または特定のタグ（例: "v1.0.0"）
  # asset_pattern: ".*\\.jar$"  # オプション: assetのパターン
  # filename: "MyPlugin.jar"    # オプション: 保存するファイル名
```

- `repo`: GitHubリポジトリを `owner/repository` 形式で指定
- `tag`: `"latest"` で最新リリース、または特定のタグ（例: `"v1.0.0"`）
- `asset_pattern`: （オプション）ダウンロードするassetの正規表現パターン。省略時は `.jar$`
- `filename`: （オプション）保存するファイル名。省略時はassetのファイル名

#### 使用例

```yaml
# 最新リリースから.jarファイルをダウンロード
- name: "DiscordSRV"
  source: "github"
  repo: "DiscordSRV/DiscordSRV"
  tag: "latest"

# 特定のタグからダウンロード
- name: "MyPlugin"
  source: "github"
  repo: "myuser/myplugin"
  tag: "v1.2.3"

# 複数の.jarがある場合、パターンで指定
- name: "AdvancedPlugin"
  source: "github"
  repo: "user/plugin"
  tag: "latest"
  asset_pattern: "AdvancedPlugin-.*-all\\.jar$"  # "-all.jar"で終わるファイル

# ファイル名を指定
- name: "CustomPlugin"
  source: "github"
  repo: "user/customplugin"
  tag: "latest"
  filename: "CustomPlugin-latest.jar"
```

#### 注意事項

- GitHub APIには認証なしで1時間あたり60リクエストのレート制限があります
- プライベートリポジトリはサポートされていません
- リリースにアセットが含まれていない場合はダウンロードできません

## SFTP接続

Pterodactylのゲームサーバーパネルから、SFTP接続情報を確認できます。

- **ホスト**: サーバーアドレス
- **ポート**: 通常は2022
- **ユーザー名**: Pterodactylのユーザー名（通常はサーバーID）
- **パスワード**: Pterodactylのパスワード

または秘密鍵を使用することもできます。

```yaml
sftp:
  host: "sftp.example.com"
  port: 2022
  username: "your-username"
  private_key_path: "~/.ssh/id_rsa"
  remote_path: "/plugins"
```

## クリーンアップ機能

新しいプラグインをアップロードした後、サーバー上の古いプラグインを自動的に削除できます。

```yaml
cleanup:
  # クリーンアップを有効にする
  enabled: true

  # 保持するファイルのパターン（正規表現）
  # これらのパターンに一致するファイルは削除されません
  keep_patterns:
    - "^CustomPlugin-.*\\.jar$"  # カスタムプラグインは保持
    - "^DoNotDelete.*\\.jar$"     # 削除しないプラグイン

  # ダウンロードしたプラグインの古いバージョンを自動削除
  # trueの場合、例えば EssentialsX-2.20.0.jar があって EssentialsX-2.20.1.jar を
  # ダウンロードした場合、古い 2.20.0 を削除します
  remove_old_versions: true
```

### クリーンアップの動作

1. **新しくアップロードしたファイル**: 削除されません
2. **keep_patternsに一致するファイル**: 削除されません
3. **remove_old_versions が true の場合**: 同じプラグイン名の古いバージョンが削除されます

例：
- `EssentialsX-2.20.1.jar` をアップロード
- サーバーに `EssentialsX-2.20.0.jar` が存在
- → `EssentialsX-2.20.0.jar` が自動削除されます

### 正規表現パターンの例

```yaml
keep_patterns:
  # 特定のプラグインを保持
  - "^MyCustomPlugin-.*\\.jar$"

  # 複数のプラグインを保持
  - "^(PluginA|PluginB|PluginC)-.*\\.jar$"

  # dev版を保持
  - ".*-dev\\.jar$"

  # 特定のプレフィックスを保持
  - "^Custom.*\\.jar$"
```

## トラブルシューティング

### プラグインが見つからない

- Modrinthの場合: `project_id`が正しいか確認してください
- Spigotの場合: `resource_id`が正しいか確認してください

### 適合するバージョンが見つからない

- `minecraft_version`が正しく設定されているか確認してください
- プラグインが指定したMinecraftバージョンに対応しているか確認してください

### SFTP接続エラー

- ホスト、ポート、ユーザー名、パスワードが正しいか確認してください
- Pterodactylサーバーが起動しているか確認してください
- ファイアウォールでSFTPポートが開いているか確認してください

## ライセンス

MIT
