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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.28.0/campfire-darwin-arm64.tar.gz"
      sha256 "4b4a59a446c15b81b6f7af4a59387cb9c867d5ee32557832fa3dcaeaba1f5a44"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.28.0/campfire-darwin-x64.tar.gz"
      sha256 "e8943eddc3225fef39ab8cc2b4713803ddc9ebb1317ba7745749cda3f2626ac3"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.28.0/campfire-linux-arm64.tar.gz"
      sha256 "a360459a7ccbf8b140c6abf0297d84bd98273212518772b4467b4d3d287736a1"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.28.0/campfire-linux-x64.tar.gz"
      sha256 "6d9e689caef83ec3fc1f799e045c52f8a7eac5154a595aa955497444c961897b"
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
