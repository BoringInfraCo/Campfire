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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.3/campfire-darwin-arm64.tar.gz"
      sha256 "a8d1a347a1930c97d137fede68e4d9ebae55079d7c5040111f01e94a79d47680"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.3/campfire-darwin-x64.tar.gz"
      sha256 "a2d5871bbede3a57c2e4ccedf37afcd2d90c2266bee61dab490062cea1f2df31"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.3/campfire-linux-arm64.tar.gz"
      sha256 "7b2fc07473023a860772350ce69f62a4eb97569bd34e430ccc2df080619c77e5"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.3/campfire-linux-x64.tar.gz"
      sha256 "5e30e2d85daf47b68cfc7790bc3e8e8d0063f6ae06bead1de4bb7e74bd2f1e6a"
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
