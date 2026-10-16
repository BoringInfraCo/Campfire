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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.19.0/campfire-darwin-arm64.tar.gz"
      sha256 "96faf50703572731bed9cddbf01a76bb94eddcb4060a0f1db936af7f294efee2"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.19.0/campfire-darwin-x64.tar.gz"
      sha256 "83b1f4456003017bb5d5d333c719a63fd07129f8f3cb4a14bfbb2a23a5adbedc"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.19.0/campfire-linux-arm64.tar.gz"
      sha256 "49bd6f79818b7862f3dc8d8586c5ab685ef886b1ef80f88b1c762c74f0459a30"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.19.0/campfire-linux-x64.tar.gz"
      sha256 "291f134808157e0101bb23fbac6d4b9bc8faece311d50c322f7658de4f326d24"
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
