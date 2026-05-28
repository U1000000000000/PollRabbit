require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const session = require('express-session');
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const findOrCreate = require('mongoose-findorcreate');

const app = express();

app.use(express.static("public"));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({
  extended: true
}));

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

app.use(session({
  secret: "Our little secret.",
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

main().catch(err => console.log(err));

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/polesDB');

  // use `await mongoose.connect('mongodb://user:password@127.0.0.1:27017/test');` if your database has auth enabled
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const pollSchema = new mongoose.Schema({
  hID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  options: [{
    optionName: String,
    optionValue: String,
    voteCount: Number
  }],
  mR: {
    type: Boolean,
    default: false
  },
  voters: [{
    voterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    selectedOptions: [String]
  }],
  savers: [],
  comments: [{
    commentator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    comment: String
  }],
  tags: [],
  caption: String
});


const Poll = new mongoose.model("Poll", pollSchema);

const userSchema = new mongoose.Schema({
  username: String,
  name: String,
  userId: String,
  password: String,
  googleId: String,
  polls: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Poll'
  }],
  vPolls: [{
    pollId: String,
    options: [{
      optionName: String
    }]
  }],
  savedPoll: [],
  comments: [],
  follows: [],
  followers: []
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = new mongoose.model("User", userSchema);

passport.use(User.createStrategy());

passport.serializeUser(function(user, cb) {
  process.nextTick(function() {
    cb(null, {
      id: user.id,
      username: user.username
    });
  });
});

passport.deserializeUser(function(user, cb) {
  process.nextTick(function() {
    return cb(null, user);
  });
});

passport.use(new GoogleStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: "https://pollrabbit.onrender.com/auth/google/game",
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
  },
  function(accessToken, refreshToken, profile, cb) {
    console.log(profile);

    User.findOrCreate({
      googleId: profile.id
    }, function(err, user) {
      return cb(err, user);
    });
  }
));

app.get("/auth/google",
  passport.authenticate("google", {
    scope: ["profile"]
  })
);


app.get("/auth/google/game",
  passport.authenticate("google", {
    failureRedirect: "/login"
  }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.redirect('/');
  });

app.get("/login", function(req, res) {
  res.render("login");
});

app.get("/register", function(req, res) {
  res.render("register");
});

app.get("/logout", function(req, res) {
  req.logout(function(err) {
    if (err) {
      return next(err);
    }
    res.redirect('/');
    console.log("logged out");
  });
});

app.get("/submit", function(req, res) {
  if (req.isAuthenticated()) {
    res.render("submit", {
      cUser: req.user
    })
  } else {
    res.redirect("/login");
  }
});

app.get("/poll/:pollId", async function(req, res) {
  try {
    Poll.findOne({
        "_id": req.params.pollId
      })
      .populate('hID', 'username')
      .populate('comments.commentator', 'username')
      .catch(err => res.send("no such poll found"))
      .then(function(poll) {
        if (poll) {
          res.render("poll", {
            poll: poll,
            cUser: req.user
          });
        } else {
          res.send("No such polls found");
        }
      })
  } catch (err) {
    res.status(500).send("Server error");
  }
});

app.get("/saved", async function(req, res) {
  if (req.isAuthenticated()) {
    try {
      const foundUser = await User.findOne({
          "_id": req.user.id
        })
        .exec()

      if (foundUser) {
        const foundPolls = await Poll.find({
            _id: {
              $in: foundUser.savedPoll
            }
          })
          .populate('hID', 'username')
          .exec();

        const userVotes = req.isAuthenticated()
          ? (await User.findById(req.user.id).select('vPolls')).vPolls
          : [];

        res.render("saves", {
          polls: foundPolls,
          cUser: req.user,
          userVotes: userVotes
        });
      }
    } catch (err) {
      res.status(500).send("Server error");
    }
  } else {
    res.redirect("/login");
  }
});

app.get("/health",async function(req, res) {
  res.send("I am awake!");
})

app.get("/", async function(req, res) {
  try {
    const polls = await Poll.find({ options: { $ne: null } })
      .populate('hID', 'username');

    const userVotes = [];
     const userFollows = [];

     if (req.isAuthenticated()) {
       const user = await User.findById(req.user.id);
       if (user) {
         userVotes.push(...user.vPolls);
         userFollows.push(...user.follows);
       }
     }


    res.render("home", {
      polls: polls,
      cUser: req.user,
      userVotes: userVotes
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


app.get("/:user?", async function(req, res) {
  try {
    const foundUser = await User.findOne({
      "username": req.params.user
    }).populate('polls').exec();

    const userVotes = req.isAuthenticated()
      ? (await User.findById(req.user.id).select('vPolls')).vPolls
      : [];

    if (foundUser) {
      const foundPolls = await Poll.find({
        _id: {
          $in: foundUser.polls
        }
      }).exec();

      res.render("user", {
        user: foundUser,
        polls: foundPolls,
        cUser: req.user,
        userVotes: userVotes
      });
    } else {
      res.send("No user found.");
    }
  } catch (err) {
    console.log(err);
    res.status(500).send("Server error");
  }
});



app.post("/submit", function(req, res) {

  if (req.isAuthenticated()) {
    let optionsArray = [];

    const nominees = req.body.nominees;

    nominees.forEach((nominee, index) => {
      const option = String.fromCharCode(65 + index);
      if (nominee) {
        optionsArray.push({
          optionName: option,
          optionValue: nominee,
          voteCount: 0
        });
      }
    });

    const poll = new Poll({
      hID: req.user.id,
      options: optionsArray,
      mR: req.body.tick ? 1 : 0
    });

    poll.save()
      .then(savedPoll => {
        User.findById(req.user.id)
          .then(foundUser => {
            if (foundUser) {
              foundUser.polls.push(savedPoll.id);
              foundUser.save().then(() => res.redirect("/"));
            }
          })
          .catch(err => console.log(err));
      })
      .catch(err => console.log(err));
  }
});

app.post("/vote", async function(req, res) {
  if (req.isAuthenticated()) {
    try {
      const poll = await Poll.findById(req.body.pollId);

      if (poll) {
        const nominee = poll.options.find(option => option.optionName === req.body.voteOption);

        if (!nominee) {
          return res.status(404).json({
            success: false,
            message: "Nominee not found"
          });
        }

        const user = await User.findById(req.user.id);
        let userPoll = user.vPolls.find(poll => poll.pollId === req.body.pollId);
        let voter = poll.voters.find(voter => String(voter.voterId) === String(req.user.id));

        if (poll.mR) {
          if (userPoll) {
            const votedOption = userPoll.options.find(option => option.optionName === req.body.voteOption);

            if (votedOption) {
              nominee.voteCount--;
              userPoll.options = userPoll.options.filter(option => option.optionName !== req.body.voteOption);

              // Update voter's selected options
              voter.selectedOptions = voter.selectedOptions.filter(option => option !== req.body.voteOption);

              // If no options left, remove the voter
              if (voter.selectedOptions.length === 0) {
                poll.voters = poll.voters.filter(v => String(v.voterId) !== String(req.user.id));
              }
            } else {
              nominee.voteCount++;
              userPoll.options.push({
                optionName: req.body.voteOption
              });

              // Add the new selected option for the voter
              if (voter) {
                voter.selectedOptions.push(req.body.voteOption);
              } else {
                poll.voters.push({
                  voterId: req.user.id,
                  selectedOptions: [req.body.voteOption]
                });
              }
            }
          } else {
            nominee.voteCount++;
            user.vPolls.push({
              pollId: req.body.pollId,
              options: [{
                optionName: req.body.voteOption
              }]
            });

            // Add new voter to the voters array
            poll.voters.push({
              voterId: req.user.id,
              selectedOptions: [req.body.voteOption]
            });
          }
        } else {
          if (userPoll) {
            const votedOption = userPoll.options.find(option => option.optionName === req.body.voteOption);
            if (votedOption) {
              nominee.voteCount--;
              user.vPolls.pull(userPoll);
              poll.voters = poll.voters.filter(v => String(v.voterId) !== String(req.user.id));
            } else {
              const exN = userPoll.options.find(option => option.optionName !== req.body.voteOption);
              const previousNominee = poll.options.find(option => option.optionName === exN.optionName);
              previousNominee.voteCount--;

              user.vPolls.pull(userPoll);
              nominee.voteCount++;

              user.vPolls.push({
                pollId: req.body.pollId,
                options: [{
                  optionName: req.body.voteOption
                }]
              });

              // Update the voter's selected option
              if (voter) {
                voter.selectedOptions = [req.body.voteOption];
              } else {
                poll.voters.push({
                  voterId: req.user.id,
                  selectedOptions: [req.body.voteOption]
                });
              }
            }
          } else {
            nominee.voteCount++;
            user.vPolls.push({
              pollId: req.body.pollId,
              options: [{
                optionName: req.body.voteOption
              }]
            });

            // Add new voter to the voters array
            poll.voters.push({
              voterId: req.user.id,
              selectedOptions: [req.body.voteOption]
            });
          }
        }

        await poll.save();
        await user.save();

        res.json({
          success: true,
          poll: poll
        });
      } else {
        res.status(404).json({
          success: false,
          message: "Poll not found"
        });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Internal Server Error"
      });
    }
  } else {
    return res.status(401).json({
      success: false,
      message: "Not authenticated",
      redirect: "/login"
    });
  }
});

app.post("/follow", async function(req, res) {
  if (req.isAuthenticated()) {
    try {
      const fUser = await User.findById(req.body.hostId);
      const user = await User.findById(req.user.id);

      if (!fUser) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      const isfUserFollowedByUser = user.follows.includes(fUser.id);
      const isUserInFollowers = fUser.followers.includes(user.id);

      if (isfUserFollowedByUser && isUserInFollowers) {
        user.follows = user.follows.filter(fUsersId => String(fUsersId) !== String(fUser.id));
        fUser.followers = poll.followers.filter(followingUsersId => String(followingUsersId) !== String(user.id));
      } else {
        if (!isfUserFollowedByUser) user.follows.push(fUser.id);
        if (!isUserInFollowers) fUser.followers.push(user.id);
      }

      await fUser.save();
      await user.save();


      return res.json({
        success: true,
        poll: poll
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: "Internal Server Error"
      });
    }
  } else {
    return res.status(401).json({
      success: false,
      message: "Not authenticated",
      redirect: "/login"
    });
  }
});

app.post("/comment", async function(req, res) {
  if (req.isAuthenticated()) {
    try {
      const foundPoll = await Poll.findById(req.body.pollId);
      if (!foundPoll) {
        return res.status(404).json({
          success: false,
          message: "Poll not found"
        });
      }

      foundPoll.comments.push({
        commentator: req.user.id,
        comment: req.body.comment
      });

      await foundPoll.save();

      const foundUser = await User.findById(req.user.id);
      if (!foundUser) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      foundUser.comments.push({
        poll: foundPoll._id,
        comment: req.body.comment
      });

      await foundUser.save();

      const updatedPoll = await Poll.findById(req.body.pollId)
        .populate('comments.commentator', 'name username')
        .exec();

      res.json({
        success: true,
        poll: updatedPoll
      });

    } catch (err) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: "Internal Server Error"
      });
    }
  } else {
    return res.status(401).json({
      success: false,
      message: "Not authenticated",
      redirect: "/login"
    });
  }
});

app.post("/save", async function(req, res) {
  if (req.isAuthenticated()) {
    try {
      const poll = await Poll.findById(req.body.pollId);
      const user = await User.findById(req.user.id);

      if (!poll || !user) {
        return res.status(404).json({
          success: false,
          message: "Poll or User not found"
        });
      }

      const isPollSavedByUser = user.savedPoll.includes(poll.id);
      const isUserInSavers = poll.savers.includes(user.id);

      if (isPollSavedByUser && isUserInSavers) {
        user.savedPoll = user.savedPoll.filter(savedPollId => String(savedPollId) !== String(poll.id));
        poll.savers = poll.savers.filter(saverId => String(saverId) !== String(user.id));
      } else {
        if (!isPollSavedByUser) user.savedPoll.push(poll.id);
        if (!isUserInSavers) poll.savers.push(user.id);
      }

      await user.save();
      await poll.save();

      return res.json({
        success: true,
        poll: poll
      });
    } catch (Error) {
      res.status(500).json({
        success: false,
        message: "Internal Server Error"
      });
    }

  } else {
    return res.status(401).json({
      success: false,
      message: "Not authenticated",
      redirect: "/login"
    });
  }
});


app.post("/register", function(req, res) {

  User.register({
    username: req.body.username,
    name: req.body.name,
    userId: req.body.userId
  }, req.body.password, function(err, user) {
    if (err) {
      console.log(err);
      res.redirect("/register");
    } else {
      passport.authenticate("local")(req, res, function() {
        res.redirect("/");
      });
    }
  });
});

app.post("/login", function(req, res) {

  if (req.body.determineLI === "username") {
    const user = new User({
      username: req.body.username,
      password: req.body.password
    });

    passport.authenticate('local', function(err, user, info) {

      if (err) {
        res.redirect('/login');
      }
      if (user) {
        req.logIn(user, function(err) {
          if (err) {
            res.redirect('/login');
          } else res.redirect('/');
        });
      } else {
        //Incorrect credentials, hence redirect to login
        return res.redirect('/login');
      }

    })(req, res);

  } else if (req.body.determineLI === "email") {

    User.findOne({
      "userId": req.body.username
    }).catch(err =>
      console.log(err)
    ).then(foundUser => {
      if (foundUser) {

        if (foundUser) {
          req.body.username = foundUser.username;
          const user = new User({
            username: req.body.username,
            password: req.body.password
          });
          passport.authenticate('local', function(err, user, info) {

            if (err) {
              res.redirect('/login');
            }
            if (user) {
              req.logIn(user, function(err) {
                if (err) {
                  res.redirect('/login');
                } else res.redirect('/');
              });
            } else {
              return res.redirect('/login');
            }
          })(req, res);
        }

      }
    });
  } else {
    console.log("something really really wrong!");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("server is running on port " + PORT);
});
