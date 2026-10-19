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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.24.0/campfire-darwin-arm64.tar.gz"
      sha256 "eecfe986f99a32464ab76bb033b1852eedf285074b2a20e73020c701db62a728"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.24.0/campfire-darwin-x64.tar.gz"
      sha256 "143670d7b082c52ba127cdba54b0d72f18ce121a8725b94fd7e584843e121cac"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.24.0/campfire-linux-arm64.tar.gz"
      sha256 "ecdfbb1c21882cf11f1f1164747a0a4c894d06a6e3f3973b80cf44f6a1ed4141"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.24.0/campfire-linux-x64.tar.gz"
      sha256 "8be0cc8fd8f36369e5b8ef5fbb8c22c2f48ff0d2089f480124b5bf034f46b685"
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
