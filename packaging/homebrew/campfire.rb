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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.28.1/campfire-darwin-arm64.tar.gz"
      sha256 "6a9788ab22dfc4f38692cc7cda34d0195fd1913f7eb4e6fda4112b2ea5b2aadd"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.28.1/campfire-darwin-x64.tar.gz"
      sha256 "82f3de7ac372f6946d047130576bb6a1fe6292437321991697e5c7da90a57bac"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.28.1/campfire-linux-arm64.tar.gz"
      sha256 "62b4cf527e84f95161b1f390ace479b2c4179fae9bee790f9f824452ac16aa80"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.28.1/campfire-linux-x64.tar.gz"
      sha256 "dcc19971773acac4e4f1b701c6bb5353b365d3f55da3734013e51b52a66726e5"
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
