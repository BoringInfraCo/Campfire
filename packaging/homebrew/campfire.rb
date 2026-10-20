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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.24.1/campfire-darwin-arm64.tar.gz"
      sha256 "bc202195bd6ac847b76f22eecb6e0bd4cc131065ed43fe9b587bedcd184d89aa"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.24.1/campfire-darwin-x64.tar.gz"
      sha256 "3e57db2ff32e1b48e365587769445280dd72eaca9223ae13b93b5000ba204470"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.24.1/campfire-linux-arm64.tar.gz"
      sha256 "9bc7dbc84fa1752a2528f3e1429bf7fd4d30bfe52b10b75d699041f0f1864eb6"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.24.1/campfire-linux-x64.tar.gz"
      sha256 "ca43b6341526a1ddacddcebe5706062e3938678f4849ff8ad92e6548f72df471"
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
