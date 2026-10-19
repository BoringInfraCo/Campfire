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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.23.0/campfire-darwin-arm64.tar.gz"
      sha256 "7812ce62bd0c8c55e0c8d2669bf9df94d0e732e5e11953e9b6c47d5147e2cb3c"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.23.0/campfire-darwin-x64.tar.gz"
      sha256 "8c41b43b1643d3b782e93f8f00137dd945a773bb003f04591089740d73f101e7"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.23.0/campfire-linux-arm64.tar.gz"
      sha256 "23c567c2e9da8e213ee80a0336a9c3962d750120a7823291961b64d177be87d2"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.23.0/campfire-linux-x64.tar.gz"
      sha256 "e5ea9bdc3190cacc278674bfd94516842f1e051e4b6d07a6317202db70121f7f"
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
