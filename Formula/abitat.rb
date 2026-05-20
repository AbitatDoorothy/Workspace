class Abitat < Formula
  desc "Remote Codex control from Mac and iPhone"
  homepage "https://github.com/AbitatDoorothy/homebrew-abitat"
  url "https://registry.npmjs.org/@abitat_reece/cli/-/cli-0.1.22.tgz"
  sha256 "ca851eb0064abe150db8edfa9409c44e3513a162aa752c1e0b3ce2055a599536"

  depends_on "python" => :build
  depends_on "node@22"

  def install
    system Formula["node@22"].opt_bin/"npm", "install", *std_npm_args
    prebuilds = libexec/"lib/node_modules/@abitat_reece/cli/node_modules/node-pty/prebuilds"
    rm_r prebuilds/"win32-arm64"
    rm_r prebuilds/"win32-x64"
    rm_r prebuilds/(Hardware::CPU.arm? ? "darwin-x64" : "darwin-arm64")
    bin.install_symlink libexec/"bin/abitat"
  end

  test do
    ENV["ABITAT_CLI_CONFIG_PATH"] = testpath/"config.json"
    assert_match "Usage: abitat", shell_output("#{bin}/abitat help")
    assert_match "Local iPhone control does not require an Abitat hosted login.", shell_output("#{bin}/abitat doctor")
  end
end
