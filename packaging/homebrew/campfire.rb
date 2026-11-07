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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.4/campfire-darwin-arm64.tar.gz"
      sha256 "fe37a22aae810a999751dd4727a15c708e5816fbf1765bed7ca318fc9e415286"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.4/campfire-darwin-x64.tar.gz"
      sha256 "710c101835807a7aaf0b0647a711967dccf5e9320ac02130c7fe5a0451288dc1"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.4/campfire-linux-arm64.tar.gz"
      sha256 "64db7771971b8da6ff230a0a2efcdddd547e15ec0709ede8c3e208b69a642ce5"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.4/campfire-linux-x64.tar.gz"
      sha256 "ff815d83a8afe38cafbaa990b74f3e89fdd1772857923efc75a61f58dba201b7"
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
