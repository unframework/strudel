var dir = thisProcess.nowExecutingPath.dirname;

{ |dirt|
	["synths", "corpus", "drone", "grit", "ofilters", "daverb"].do { |name| (dir +/+ name ++ ".scd").load.(dirt) };
}
