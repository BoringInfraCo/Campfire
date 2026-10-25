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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.2/campfire-darwin-arm64.tar.gz"
      sha256 "e97f8c3d3af3cad350769265b2fdfdefa4b733b4fde54ffa84c6bddc56c900e7"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.2/campfire-darwin-x64.tar.gz"
      sha256 "9d24897b3eae166aebdd3e3931e6010b5db6bfe0dbc9a9f87c294c0c7ccbbbcf"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.2/campfire-linux-arm64.tar.gz"
      sha256 "d859d1b2d490cf36930ca458d9c2920212fe89ee071bb2acf1417932bce4f675"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.26.2/campfire-linux-x64.tar.gz"
      sha256 "67d8acc483ddbda13c987aeef1b51b1b2118c7ad19db05f52d4eadef708d3ae1"
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
