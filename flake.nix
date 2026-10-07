{
  description = "Campfire, the shared workspace where people and their agents work together";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      # Pins the published release archives. Update with
      # `node scripts/sync-install-channels.mjs` after the four checksums exist.
      # This flake does not compile better-sqlite3 and does not send telemetry.
      version = "1.12.0";
      systems = [ "aarch64-darwin" "x86_64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems f;
      campfireFor = system:
        let
          pkgs = import nixpkgs { inherit system; };
          archives = {
            aarch64-darwin = {
              name = "campfire-darwin-arm64.tar.gz";
              hash = "sha256-9qHVqGqhlG4Aq+J2oCCjpIkAEsrGikb9zi7i0qc7C2o="; # campfire-darwin-arm64.tar.gz
            };
            x86_64-darwin = {
              name = "campfire-darwin-x64.tar.gz";
              hash = "sha256-DMR4meg8/Rdx3iT3yity/MBlaI2heHayNxjMHLWTCxw="; # campfire-darwin-x64.tar.gz
            };
            aarch64-linux = {
              name = "campfire-linux-arm64.tar.gz";
              hash = "sha256-UKyOfOqHmI5B/3pKerekldr67+TnwQJ2pdFeiqMN+E0="; # campfire-linux-arm64.tar.gz
            };
            x86_64-linux = {
              name = "campfire-linux-x64.tar.gz";
              hash = "sha256-++wPWi2owrrQaPhtLIo83xYqQbzQsixtcrBj2asxHK0="; # campfire-linux-x64.tar.gz
            };
          };
          archive = archives.${system};
        in
        pkgs.stdenv.mkDerivation {
          pname = "campfire";
          inherit version;
          src = pkgs.fetchurl {
            url = "https://github.com/BoringInfraCo/Campfire/releases/download/v${version}/${archive.name}";
            hash = archive.hash;
          };
          nativeBuildInputs = [ pkgs.makeWrapper ];
          # The release archive has bin/ and lib/ at the top. stdenv's default
          # unpack rejects an archive that does not contain exactly one directory.
          unpackPhase = ''
            runHook preUnpack
            tar -xzf "$src" -C .
            runHook postUnpack
          '';
          dontConfigure = true;
          dontBuild = true;
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -R bin lib $out/
            chmod +x $out/bin/campfire
            wrapProgram $out/bin/campfire --prefix PATH : ${pkgs.nodejs-slim_22}/bin
            runHook postInstall
          '';
          meta = {
            description = "The shared workspace where people and their agents work together";
            homepage = "https://github.com/BoringInfraCo/Campfire";
            license = pkgs.lib.licenses.asl20;
            mainProgram = "campfire";
            platforms = systems;
            sourceProvenance = [ pkgs.lib.sourceTypes.binaryNativeCode ];
          };
        };
    in
    {
      packages = forAllSystems (system:
        let
          campfire = campfireFor system;
        in
        {
          inherit campfire;
          default = campfire;
        });

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/campfire";
        };
      });
    };
}
