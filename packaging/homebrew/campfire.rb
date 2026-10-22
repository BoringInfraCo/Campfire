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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.1/campfire-darwin-arm64.tar.gz"
      sha256 "93ae6aff467203a58ca3b8c8a42fd7c7a7cc56ebae36ab01418fb998ea22b23b"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.1/campfire-darwin-x64.tar.gz"
      sha256 "1d6213bb2438b8af878b3ac410f1227e065fad728f9ddaf96bd113b672933a33"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.1/campfire-linux-arm64.tar.gz"
      sha256 "ab3909b6ea9b6d10f4da43848e2e2b1b5b9b6c9e636bd6a3f9aad5024d775dd5"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.1/campfire-linux-x64.tar.gz"
      sha256 "7c6bdd83716475bf9a54216003ba8bb9da444d98706b2c92af4dcb6e6baa3a39"
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
