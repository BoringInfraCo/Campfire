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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.18.0/campfire-darwin-arm64.tar.gz"
      sha256 "891a1e5be28027e3b3191d169ffbc89a3e83995be7163b667029be71ae2ee4ea"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.18.0/campfire-darwin-x64.tar.gz"
      sha256 "e1bf7a647fda7809e53eb66be999f21f74d4cab540f186b55c67e0bc71aa751d"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.18.0/campfire-linux-arm64.tar.gz"
      sha256 "de21485fe8eb2caf9263d7996c1693d4ab90d828f48ba45b771d151a6773c280"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.18.0/campfire-linux-x64.tar.gz"
      sha256 "3c91e28f718948f5e6a208019948606007342e12c33ec10a87ab93ebadf21d67"
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
