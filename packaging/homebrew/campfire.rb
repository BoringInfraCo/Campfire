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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.22.1/campfire-darwin-arm64.tar.gz"
      sha256 "1dcb9b4b2888382e535bfe34159507dc153bd120be724e21a4f7cb6a23a6cebf"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.22.1/campfire-darwin-x64.tar.gz"
      sha256 "36e588647e4b3c1b68b8f50e67d524650c5b159cd0f6a09352f6ee99bb3a5428"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.22.1/campfire-linux-arm64.tar.gz"
      sha256 "ca6f3d57cfeead75697b3c1e7bce2fcbe22b72cf34d8d5fa7c75164c55e792b5"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.22.1/campfire-linux-x64.tar.gz"
      sha256 "7e260b5d6eb878340b8d081c6d5b7575b2b0adc66ebac156208d018bb661c4e8"
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
