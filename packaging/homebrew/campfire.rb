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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.17.0/campfire-darwin-arm64.tar.gz"
      sha256 "b9e4c27275d0b4eac488c4e26a0ee6146ea45a63fe6a91750b5a6a288b54f0f1"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.17.0/campfire-darwin-x64.tar.gz"
      sha256 "a38de7f57050aa193c3e698f2cf2c5fec795d518b252539c29a980c4e88bca42"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.17.0/campfire-linux-arm64.tar.gz"
      sha256 "04d80ea57eb4b869929c0e7b4a651294de570bc52532836b3c6d3f7ed0ff40ca"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.17.0/campfire-linux-x64.tar.gz"
      sha256 "b476534b2d3d6d41cbebc3485bbbd391b9a9fa60b5742b98e6be2970470a9f33"
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
