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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.7/campfire-darwin-arm64.tar.gz"
      sha256 "5777a738dd2143c8107636d71758e04b1d0afed04b1d7a90a22c1b6b5302e2db"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.7/campfire-darwin-x64.tar.gz"
      sha256 "c76f8550fcbdc3d314c847b1714d5f004a4f3041be66cc9da2774af9afc01df2"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.7/campfire-linux-arm64.tar.gz"
      sha256 "86d965a773e3696c07def7a0fc1d140b95658b37350d9671217bb0fd6bdfe3e4"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.7/campfire-linux-x64.tar.gz"
      sha256 "cf987acef16e216079e923d5b792f9d092e98ce7c7c58b633d97de7b61cf3403"
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
