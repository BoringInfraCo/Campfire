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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.22.0/campfire-darwin-arm64.tar.gz"
      sha256 "da98a10e273b02403fb33b12e2292e1006d6ddd61b5eac92c43007eddc2229f2"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.22.0/campfire-darwin-x64.tar.gz"
      sha256 "8a19e9aaef00a106778c16c5fd70631b2c0389bc3e7c8e35398d89626f83d5a8"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.22.0/campfire-linux-arm64.tar.gz"
      sha256 "5770dd8a7be55cc376272cf83d3fe10c603bb105bdf8e2b1c4dd305ddbb3dc12"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.22.0/campfire-linux-x64.tar.gz"
      sha256 "a5cc431978353709fdf5a5c58cd218221545388a322b4a902d20aef64c41dcf9"
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
