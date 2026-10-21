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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.25.0/campfire-darwin-arm64.tar.gz"
      sha256 "5e86769758a952bf8489fa1755f7c654c223ad8402cc2f2e8bf98215429d770f"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.25.0/campfire-darwin-x64.tar.gz"
      sha256 "d9f5155d9b389a6f7a587da229498ada54436ebcd8fc4fe412ec38667d0f1429"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.25.0/campfire-linux-arm64.tar.gz"
      sha256 "367e3163361cab65598229724a738626af0ddf2c6f3c12a20f3f6408187cbd20"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.25.0/campfire-linux-x64.tar.gz"
      sha256 "1cb949cbd7b83e61b7a841c765bbc77349a97fdacae774149838e896cb9d1504"
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
