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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.21.0/campfire-darwin-arm64.tar.gz"
      sha256 "8dd62e1e0656899be58d8b177539a440985e491697991a0859a4cf899dd5e8c7"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.21.0/campfire-darwin-x64.tar.gz"
      sha256 "4b419a9f3573c4c485d3ee108df8e845647e59d1c8309c8790ea130150cbbeb5"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.21.0/campfire-linux-arm64.tar.gz"
      sha256 "ab1f900d5ceaafa33af949fda8199c222291f07d0f0cac04b7bdba26655c4063"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.21.0/campfire-linux-x64.tar.gz"
      sha256 "006cff15c1fd56922c979d68658d2ea4c219f223fb0d1ac03d7402e8dda3bbda"
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
