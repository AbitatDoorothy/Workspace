class Abitat < Formula
  desc "Remote Codex control from Mac and iPhone"
  homepage "https://workspace.abitat.io"
  url "https://registry.npmjs.org/@abitat/cli/-/cli-0.1.0.tgz"
  sha256 "8cedb3a2433b3ee1b05fae3242ec0edbe9e1fb5a1d05e323ffa36465a65289a7"

  depends_on "python" => :build
  depends_on "node@22"

  def install
    system Formula["node@22"].opt_bin/"npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/abitat"
  end

  test do
    assert_match "Usage: abitat", shell_output("#{bin}/abitat help")
    assert_match "Not logged in. Run `abitat login`.", shell_output("#{bin}/abitat doctor")
  end
end
