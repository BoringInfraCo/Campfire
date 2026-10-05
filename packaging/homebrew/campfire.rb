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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.11.0/campfire-darwin-arm64.tar.gz"
      sha256 "f48554d6845fed298116c4b444ae2592ff0fa0b98d9692de292fe15ca92a3fae"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.11.0/campfire-darwin-x64.tar.gz"
      sha256 "023135e791504cfbd3af2c7ac6346f2934250ea285affb6a655e740559dc516c"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.11.0/campfire-linux-arm64.tar.gz"
      sha256 "b1691515f4778ba9e8801a60207e0448ed05ae8ba76ec53c0460a37cce5eb5d2"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.11.0/campfire-linux-x64.tar.gz"
      sha256 "7212dd81e153abaf12d70dcc9adcf606ecd46db1119d23f2cea10e046ab41a5d"
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
