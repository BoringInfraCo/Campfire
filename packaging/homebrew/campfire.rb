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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.13.0/campfire-darwin-arm64.tar.gz"
      sha256 "256de98f724db036aa289189464475bb97e1297f9e42f8148656ab98b0b0c7a6"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.13.0/campfire-darwin-x64.tar.gz"
      sha256 "729e13f9cf1e7b11fb8a49a14a66bb4dde8e0bb07f68a205008b34e3d498350d"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.13.0/campfire-linux-arm64.tar.gz"
      sha256 "1e69cc07342b8d2ad11b8dee48fea740b667faadaa7a624e79bbd2bd00c992aa"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.13.0/campfire-linux-x64.tar.gz"
      sha256 "1de5903c1c92adccda0eddc0bbef00388864d1d855e8c13ad607ce139c7c5a2b"
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
