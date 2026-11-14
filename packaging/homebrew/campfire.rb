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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.31.0/campfire-darwin-arm64.tar.gz"
      sha256 "4c82a6bb9b594d9bff0d9623b9305b86d3c08f15a3118e7038a1bd2fd09f4a22"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.31.0/campfire-darwin-x64.tar.gz"
      sha256 "cffe90519bd9869830f8335850ae31a2cd5316d101a0a65f50a54763f9b7f72a"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.31.0/campfire-linux-arm64.tar.gz"
      sha256 "beadfa098060952d84ac86ce5a08268a143503b77e9f76816be8bc7019f75103"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.31.0/campfire-linux-x64.tar.gz"
      sha256 "6f12c9aea45f6be7f7b4c133e15a0c9086a2168ce13d6b908ff11625cc2a8e65"
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
