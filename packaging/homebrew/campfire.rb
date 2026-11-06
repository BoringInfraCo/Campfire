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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.0/campfire-darwin-arm64.tar.gz"
      sha256 "6c03d86ddcb58129919e991276e4bf5d6a8965681534e0e119f41475ff92e963"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.0/campfire-darwin-x64.tar.gz"
      sha256 "67c7e634a80bf289c60567335b67713a0bf796bfc35ce209253915c1d5577821"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.0/campfire-linux-arm64.tar.gz"
      sha256 "59324cad2775e551d1c1c59804f7b71ae1490a5dc2fc6d87f538b77d02d2cb93"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.0/campfire-linux-x64.tar.gz"
      sha256 "49c3da4e0456ee9bcb58070eda45de0da3df7ea94f3ad21da8ee6422cd2ee995"
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
