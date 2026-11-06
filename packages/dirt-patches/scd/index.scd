var dir = thisProcess.nowExecutingPath.dirname;

{ |dirt|
	["synths", "corpus", "drone", "grit", "ofilters", "daverb", "tremolo", "duck"].do { |name| (dir +/+ name ++ ".scd").load.(dirt) };
}
