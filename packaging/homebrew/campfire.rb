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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.33.1/campfire-darwin-arm64.tar.gz"
      sha256 "0b57bf8a9e3d204d37c205949b6f6ada7f3f553dc7b875f6ff008338fa9aefc5"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.33.1/campfire-darwin-x64.tar.gz"
      sha256 "0f4af7336846978443f1b9ab21470633a178252ad1f7f816ab33d022bc6229c2"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.33.1/campfire-linux-arm64.tar.gz"
      sha256 "7b14f6a3b0296768d0120918148e4f6b7f76022dc17725c9a788649451821074"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.33.1/campfire-linux-x64.tar.gz"
      sha256 "4e4a669e5b43eba08c32fb5954e0e89d06246a94f4298d135761a608136b74d5"
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
