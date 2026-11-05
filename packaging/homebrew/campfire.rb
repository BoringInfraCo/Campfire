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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.27.0/campfire-darwin-arm64.tar.gz"
      sha256 "e76354ecf3c78305b4e449eefe84301f8bd726217832d79192be145f697987cd"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.27.0/campfire-darwin-x64.tar.gz"
      sha256 "a7af736048293388b60a861952f57983b5c2b0b0df5a438d2e9edaee378edf8e"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.27.0/campfire-linux-arm64.tar.gz"
      sha256 "1c5e89e003cd2380610a276ec9f795166a38db475499222e6792f318a4b209f3"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.27.0/campfire-linux-x64.tar.gz"
      sha256 "069c30ac399ea04777563e1c438f44f258388965483aaba7dbc46fc54fa3d9f9"
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
