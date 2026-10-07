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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.12.0/campfire-darwin-arm64.tar.gz"
      sha256 "f6a1d5a86aa1946e00abe276a020a3a4890012cac68a46fdce2ee2d2a73b0b6a"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.12.0/campfire-darwin-x64.tar.gz"
      sha256 "0cc47899e83cfd1771de24f7ca2b72fcc065688da17876b23718cc1cb5930b1c"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.12.0/campfire-linux-arm64.tar.gz"
      sha256 "50ac8e7cea87988e41ff7a4a7ab7a495dafaefe4e7c10276a5d15e8aa30df84d"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.12.0/campfire-linux-x64.tar.gz"
      sha256 "fbec0f5a2da8c2bad068f86d2c8a3cdf162a41bcd0b22c6d72b063d9ab311cad"
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
