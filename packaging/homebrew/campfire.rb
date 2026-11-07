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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.6/campfire-darwin-arm64.tar.gz"
      sha256 "354900f028e37b9babf8bfbefc32e84ea772fa02f07c29228d795c2fe0f79e6d"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.6/campfire-darwin-x64.tar.gz"
      sha256 "4779289073bc62054500b26facc91e78a06d928f82cdf16c48c65bbc4a1bc006"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.6/campfire-linux-arm64.tar.gz"
      sha256 "2de4cafe7e8f85c80377742c2d3988a827431ff541dab56030019c119f795ec4"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.6/campfire-linux-x64.tar.gz"
      sha256 "f9072805d4217f6cac0be2e5423d2dc68dc1047fb51581ca353899dc400a2b94"
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
