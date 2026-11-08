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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.30.0/campfire-darwin-arm64.tar.gz"
      sha256 "b4e29aa908b44202ee49398356f35a5227bd4c8db876e9488dc3d5355ef7e0eb"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.30.0/campfire-darwin-x64.tar.gz"
      sha256 "196372c2e88e5dfc9cdeea779fdbfcc34bf6dc5287ed0aeb349c457c56b4a4a5"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.30.0/campfire-linux-arm64.tar.gz"
      sha256 "223bca826d14f580d9a1f387700c66284392ed4419f4ea0d2de8746231b6fc40"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.30.0/campfire-linux-x64.tar.gz"
      sha256 "f179f687b3fbc043cd05fffeb792bbb8ce07d0ea6535cf0ac54c7ded229f1a19"
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
