# FastPack application (web client)
package uSAC::FastPack::Broker::App;
=head1 NAME

uSAC::FastPack::Broker::App - Web client files for uSAC::FastPack::Broker

=cut

use v5.36;

use feature ":all";
our $VERSION="v0.1.0";


use Data::JPack;
use Data::JPack::App;
use Template::Plexsite;

use File::ShareDir ":ALL";

use File::Path qw<make_path>;
use File::Basename qw<dirname>;

my $share_dir=dist_dir "uSAC-FastPack-Broker-App";


# Return the paths of sourse files
sub js_paths {
  say STDERR "GETTING JS PATHS FOR ".__PACKAGE__;
  grep !/test/, <$share_dir/js/*>;
}

# or we add the file to the dir directly
sub add_to_jpack_container {
  my $html_container=shift;
  # Given the html_container encode the js and resource files into the next available position
  #
  my $jpack=Data::JPack->new(jpack_compression=>"DEFLATE", jpack_type=>"app", html_container=>$html_container);


  $jpack->set_prefix("app/jpack/main");

  my @outputs;
  for(js_paths){
    say STDERR __PACKAGE__ . " adding js: ", $_;
    my $out_path=$jpack->next_file_name($_);
    next unless $out_path;

    say STDERR __PACKAGE__." OUTPUT PATH IS (broker app) $out_path";

    $jpack->encode_file($_,$out_path);
    push @outputs, $out_path;    #
  }
  @outputs;
}

sub add_to_container {
  my (undef, $t)=@_;

  return unless $t isa Template::Plexsite;

  Data::JPack::App->localize_table ($t, sub {

    my @paths=(js_paths);
    for(@paths){
      $t->add_resource($_, 
        static=>{
          config=>{
            output=>{
              filter=>{
                name=>"jpack",
              }
            }
          }
        }
      );
    }
  }
);
}

sub template_path {
  (undef, $share_dir);
}

1;

