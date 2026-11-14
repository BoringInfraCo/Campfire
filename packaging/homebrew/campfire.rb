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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.32.0/campfire-darwin-arm64.tar.gz"
      sha256 "a3a249e733db4117644136c7833a729a9841d9cba5a507481936aa4e8104753a"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.32.0/campfire-darwin-x64.tar.gz"
      sha256 "0d0e664537ba9faceed4618a6d13ef7c8fa877642327b2938c6575d2e46ba115"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.32.0/campfire-linux-arm64.tar.gz"
      sha256 "5145b18eab8ef26885bef6926ebaa27acf59c5c9ebcef3a35c40917fc81d43d3"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.32.0/campfire-linux-x64.tar.gz"
      sha256 "a37f4e9ce66716b5c6230cd9e641b21926dc68544f0dde5a076b5c08dfa70fe5"
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
