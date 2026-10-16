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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.20.1/campfire-darwin-arm64.tar.gz"
      sha256 "6262438230c43db749fc091ba28ca42a6664b245f2003d13702367e465af27f3"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.20.1/campfire-darwin-x64.tar.gz"
      sha256 "e6caa2966a7aec1b33ca134b08575ac7f19d2c6c95153b90ed507b9bbfdb4127"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.20.1/campfire-linux-arm64.tar.gz"
      sha256 "3589212cdc7d028e6908bff43838c1780b6258b0de50fa5a8cbb4c5fc276b3e9"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.20.1/campfire-linux-x64.tar.gz"
      sha256 "8d680f7179090784ddf1f9586101b581e4d48c2b09d25c8ec5276ee49c9bc1bd"
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
