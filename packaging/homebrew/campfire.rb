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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.8/campfire-darwin-arm64.tar.gz"
      sha256 "e90b2ca790b20346069666ca69c7141fc40d19a90897e7ec23e7e25d7fc1a270"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.8/campfire-darwin-x64.tar.gz"
      sha256 "b51ca4ad2b1c00af9182e4e4d3d13f43b8fbb71530fd5eac778d891835338e03"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.8/campfire-linux-arm64.tar.gz"
      sha256 "c23fda32777121b165a141475c01d992888ad62a3418bd3aebf5105035f76bce"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.8/campfire-linux-x64.tar.gz"
      sha256 "295d289a39500d2363b0ecf5b3a1c83f4e3cd86c15071ef8780370471e2a6749"
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
