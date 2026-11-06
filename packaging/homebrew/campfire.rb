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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.1/campfire-darwin-arm64.tar.gz"
      sha256 "24c3f0ce089099830ab456cc3e31d7a49146e8e7ad254c039f4784c1f2d8ed77"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.1/campfire-darwin-x64.tar.gz"
      sha256 "32193a5e8f52066eab0345117c148b13b229fa1c2800784d2a39810d1e29294e"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.1/campfire-linux-arm64.tar.gz"
      sha256 "4bc04c63ef37ba35cd4fc4fecde69b95f5e9db14fd30df934f5b6c1bdf3f62a9"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.29.1/campfire-linux-x64.tar.gz"
      sha256 "4813fda3746275d04337ad8f827adf2be4844fd91d92a5f48edca9b8fa272cea"
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
