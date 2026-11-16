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
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.33.0/campfire-darwin-arm64.tar.gz"
      sha256 "585c374549bc4e74fd43ea2f9dd64e69d639daa81eb8804ae2f73f799ff5eba7"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.33.0/campfire-darwin-x64.tar.gz"
      sha256 "ffe0431c1d692c2ed98f69fdea6153457af4d19eef13258e8e68471ab75ec477"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.33.0/campfire-linux-arm64.tar.gz"
      sha256 "8ab6f6947db82a8f4b682ceaf3817302481923ee6cb11573e77776339044f146"
    end
    on_intel do
      url "https://github.com/BoringInfraCo/Campfire/releases/download/v1.33.0/campfire-linux-x64.tar.gz"
      sha256 "a8c87200925faca7b0ee9baa25813a2bf2904e084ce2c4f6f2da7684b3b464bb"
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
