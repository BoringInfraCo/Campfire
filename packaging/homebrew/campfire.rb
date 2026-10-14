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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.16.0/campfire-darwin-arm64.tar.gz"
      sha256 "0c3317a5c6b794e20bfc9e8e64c909a723025003d2a0e7326efd4b9622648a52"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.16.0/campfire-darwin-x64.tar.gz"
      sha256 "09311957d4cf0aefe5b1fb2edf7842fdf259291012ac202e1140adb28a7c8bef"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.16.0/campfire-linux-arm64.tar.gz"
      sha256 "b1e5060b8ec4821ea17a1d16cf1b2296d6e27322209e549b8542e30f9b023acd"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.16.0/campfire-linux-x64.tar.gz"
      sha256 "ca193dbb591ae80eadb3c049096cba9fda2ee03f3be734188144a775b04f3fcc"
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
