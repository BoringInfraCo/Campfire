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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.2/campfire-darwin-arm64.tar.gz"
      sha256 "1454b153e9f21b21adb502ec171442045e1a92a37d621faec19d9ddfd184c553"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.2/campfire-darwin-x64.tar.gz"
      sha256 "b3c264c3609bce31eac616087efa166d93f8ae63343915b8f0769f30e12c95f7"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.2/campfire-linux-arm64.tar.gz"
      sha256 "6f7f2850180c9c1d131b5755ccdd5e09bfbc5bc20a1cb5a08a046342a89326aa"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.2/campfire-linux-x64.tar.gz"
      sha256 "0662a45452ddc0b51eac319be21225aee669723fb8665f3fd82a0a50af87eeee"
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
