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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.34.0/campfire-darwin-arm64.tar.gz"
      sha256 "540d0ca25124c3545bb2282d8798a69205fc5ae38d0cf386e15bc208d726ebea"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.34.0/campfire-darwin-x64.tar.gz"
      sha256 "b5460c6106c14abb2a46dc60f794973c762de1103848f86f276c6455079a7d58"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.34.0/campfire-linux-arm64.tar.gz"
      sha256 "4440c7a9f93ef50cd576c8eb9adf55aeb2b84d78f9f63fa77cd2d528cdf18e3f"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.34.0/campfire-linux-x64.tar.gz"
      sha256 "22295a044da9533f990d97c3698a688ca9b410906b0a7547e6495e071a77d567"
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
