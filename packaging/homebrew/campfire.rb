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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.35.0/campfire-darwin-arm64.tar.gz"
      sha256 "ad1676575bc318fd18e5aa36500a8ca831f1a75154f288d4c0a09a4cee954f30"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.35.0/campfire-darwin-x64.tar.gz"
      sha256 "1f1acb9cc89607d796fdbf371c046a20d61f333586b9a4f2404ef63acd912fb6"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.35.0/campfire-linux-arm64.tar.gz"
      sha256 "30d050592e15c857c613e72e9b4368fd32186bdc5c7479847f9caeb68ff87e88"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.35.0/campfire-linux-x64.tar.gz"
      sha256 "2bbd341a685510a8c086dd58d0114893445e67917c8acf4ba39f5b83fa591a2d"
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
    assert_match version.to_s, shell_output("#{bin}/campfire --version")
  end
end
