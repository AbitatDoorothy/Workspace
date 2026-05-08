class Abitat < Formula
  desc "Remote Codex control from Mac and iPhone"
  homepage "https://workspace.abitat.io"
  url "https://registry.npmjs.org/@abitat_reece/cli/-/cli-0.1.0.tgz"
  sha256 "3b11401140be2ff6ccf0bdeef793a84e8eea31c79ffae5624e0dc6352b02bb60"

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
