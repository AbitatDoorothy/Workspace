class Abitat < Formula
  desc "Remote Codex control from Mac and iPhone"
  homepage "https://github.com/AbitatDoorothy/Workspace"
  url "https://registry.npmjs.org/@abitat_reece/cli/-/cli-0.1.6.tgz"
  sha256 "9bf4b0e538c0cf4ec588b951fd05d39174e9c415fc70350ac5e7384bc689c54d"

  depends_on "python" => :build
  depends_on "cloudflared"
  depends_on "node@22"

  def install
    system Formula["node@22"].opt_bin/"npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/abitat"
  end

  test do
    ENV["ABITAT_CLI_CONFIG_PATH"] = testpath/"config.json"
    assert_match "Usage: abitat", shell_output("#{bin}/abitat help")
    assert_match "Local iPhone control does not require an Abitat hosted login.", shell_output("#{bin}/abitat doctor")
  end
end
