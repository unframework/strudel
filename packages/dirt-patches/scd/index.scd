var dir = thisProcess.nowExecutingPath.dirname;

{ |dirt|
	["synths", "corpus", "drone", "grit", "ofilters"].do { |name| (dir +/+ name ++ ".scd").load.(dirt) };
}
