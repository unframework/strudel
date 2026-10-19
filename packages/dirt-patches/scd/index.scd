var dir = thisProcess.nowExecutingPath.dirname;

{ |dirt|
	["synths", "corpus", "drone", "grit", "ofilters", "daverb", "tremolo"].do { |name| (dir +/+ name ++ ".scd").load.(dirt) };
}
