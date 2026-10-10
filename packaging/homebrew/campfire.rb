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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.14.0/campfire-darwin-arm64.tar.gz"
      sha256 "1915b09ae47ea908791707d879540cae5ba39855c0dae19ae8a79ad6852d1c53"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.14.0/campfire-darwin-x64.tar.gz"
      sha256 "bd3d3fff9fbf2f9db22a6811862c02fb9609f73b7ad9018e42a101e797104278"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.14.0/campfire-linux-arm64.tar.gz"
      sha256 "e4b804863fa62e2e75f0428c10a620da16db8d771c59265f3a0a18500800647b"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.14.0/campfire-linux-x64.tar.gz"
      sha256 "fadf79adaac4c0b3a9de71cc097a8a54ba1e805521bdf95fd84b32c498f2e4ac"
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
