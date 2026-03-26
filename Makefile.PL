use 5.036003;
use ExtUtils::MakeMaker;

use File::ShareDir::Install;
install_share dist=>"share";

# See lib/ExtUtils/MakeMaker.pm for details of how to influence
# the contents of the Makefile that is written.
WriteMakefile(
  NAME              => 'uSAC::FastPack::Broker::App',
  VERSION_FROM      => 'lib/uSAC/FastPack/Broker/App.pm', # finds $VERSION, requires EU::MM from perl >= 5.5
  PREREQ_PM         => {
    'Data::FastPack'=> v0.3.0,
    'Sub::Middler'  => v0.4.0,
    'Hustle::Table' => v0.8.0,
    'UUID'          => 0,
  }, 
  ABSTRACT_FROM     => 'lib/uSAC/FastPack/Broker/App.pm', # retrieve abstract from module
  AUTHOR            => 'Ruben Westerberg <drclaw@mac.com>',
  LICENSE           => 'mit',
  ######################################################################
  # META_ADD => {                                                      #
  #   "meta-spec" => {                                                 #
  #     version => 2                                                   #
  #   },                                                               #
  #   resources=> {                                                    #
  #     repository =>{                                                 #
  #       type => "git",                                               #
  #       url => "git://github.com/drclaw1394/perl-usac-fastpack.git", #
  #       web => "https://github.com/drclaw1394/perl-usac-fastpack",   #
  #     }                                                              #
  #   }                                                                #
  # }                                                                  #
  ######################################################################

);

package MY;
use File::ShareDir::Install qw(postamble);

