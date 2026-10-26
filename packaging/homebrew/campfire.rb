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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.3/campfire-darwin-arm64.tar.gz"
      sha256 "5e2520ad19a330bdcffd136f9b3e1365689e026e4bb26967312e4b28414b7f2c"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.3/campfire-darwin-x64.tar.gz"
      sha256 "81fbfab43732913bc420a586599ac6aa234b700c2bc368d7215fc77966224ba1"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.3/campfire-linux-arm64.tar.gz"
      sha256 "f32e35fcdf9bf1b537648751b31f2ed894e579e24eaab4d144ce9d7f8f1e13c7"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.3/campfire-linux-x64.tar.gz"
      sha256 "274b34172a8f3a231d16ec49d1db0bb12003c9ab9d2767005869f997d1b7d37e"
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
