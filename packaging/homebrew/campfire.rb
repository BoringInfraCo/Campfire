class Campfire < Formula
  desc "Shared workspace where people and their agents work together"
  homepage "https://github.com/BoringInfraCo/Campfire"
  license "Apache-2.0"
  depends_on "node@22"

  # Same checksummed GitHub Release archives as the curl installer.
  # better-sqlite3 is already compiled inside the archive. The inner
  # bin/campfire wrapper follows symlinks and then execs `node`, so the
  # outer wrapper puts Homebrew's keg-only node@22 on PATH. Install does
  # not start a service and does not report telemetry.
  on_macos do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.15.0/campfire-darwin-arm64.tar.gz"
      sha256 "4d0d61f2586e63eb246c60d18fd57ed7f3fcca64c0ad8591792a609bd88c9bdf"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.15.0/campfire-darwin-x64.tar.gz"
      sha256 "71d4a275e1b69bf3f781e117cba792ed91bdf242f5fa4fb7e48ae088fdbc47af"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.15.0/campfire-linux-arm64.tar.gz"
      sha256 "57da4fd26dc649b7f63cdd356cdf79e4719024c92ace15d9614bddb90697842a"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.15.0/campfire-linux-x64.tar.gz"
      sha256 "24d7a07fdd19ebb5b2abb1be3b274a1241e214f28920b2ebd8cabe4ab506148c"
    end
  end

  def install
    libexec.install "bin", "lib"
    (bin/"campfire").write <<~SH
      #!/bin/sh
      export PATH="#{formula_opt_bin("node@22")}:$PATH"
      exec "#{libexec}/bin/campfire" "$@"
    SH
    chmod 0755, bin/"campfire"
  end

  test do
    assert_match "Usage:", shell_output("#{bin}/campfire --help")
  end
end
