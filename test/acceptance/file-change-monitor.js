const fs = require('fs')
const nock = require('nock')
const path = require('path')
const should = require('should')
const sinon = require('sinon')
const request = require('supertest')

const cache = require('./../../dadi/lib/cache')
const help = require('./help')
const app = require('./../../dadi/lib/')
const workspace = require('./../../dadi/lib/models/workspace')

let config = require('./../../config')
let configBackup = config.get()
let cdnUrl = `http://${config.get('server.host')}:${config.get('server.port')}`
let testConfig

describe('File change monitor', function () {
  describe('Config', () => {
    before(done => {
      testConfig = JSON.parse(
        fs.readFileSync(config.configPath()).toString()
      )

      app.start(err => {
        if (err) return done(err)

        setTimeout(done, 500)
      })
    })

    after(done => {
      app.stop(() => {
        fs.writeFileSync(
          config.configPath(),
          JSON.stringify(testConfig, null, 2)
        )

        done()
      })
    })

    it('should reload the config when the current config file changes', done => {
      let configContent = JSON.parse(
        fs.readFileSync(config.configPath()).toString()
      )

      configContent.logging.level = 'trace'

      fs.writeFileSync(
        config.configPath(),
        JSON.stringify(configContent, null, 2)
      )

      setTimeout(() => {
        delete require.cache['./../../config']

        config = require('./../../config')
        config.get('logging.level').should.eql('trace')

        done()
      }, 1000)
    })
  })

  describe('Workspace', () => {
    it('should reload a recipe when the file changes', done => {
      let recipePath = path.resolve(
        'workspace', 'recipes', 'sample-image-recipe.json'
      )
      let recipe = require(recipePath)

      app.start(err => {
        if (err) return done(err)

        setTimeout(() => {
          request(cdnUrl)
          .get('/sample-image-recipe/test.jpg')
          .expect(200)
          .end((err, res) => {
            res.headers['content-type'].should.eql(
              'image/png'
            )

            let newRecipe = Object.assign({}, recipe, {
              settings: {
                format: 'jpg'
              }
            })

            fs.writeFileSync(
              recipePath,
              JSON.stringify(newRecipe, null, 2)
            )

            setTimeout(() => {
              request(cdnUrl)
                .get('/sample-image-recipe/test.jpg')
                .expect(200)
                .end((err, res) => {
                  fs.writeFileSync(
                    recipePath,
                    JSON.stringify(recipe, null, 2)
                  )

                  res.headers['content-type'].should.eql(
                    'image/jpeg'
                  )

                  app.stop(done)
                })
            }, 500)
          })
        }, 500)
      })
    })

    it('should reload a recipe at domain level when the file changes', done => {
      config.set('multiDomain.enabled', true)
      config.set('multiDomain.directory', 'domains')

      let recipePath = path.resolve(
        'domains/testdomain.com/workspace/recipes/foobar-recipe-one.json'
      )

      help.createTempFile(
        recipePath,
        {
          recipe: 'foobar-recipe-one',
          settings: {
            format: 'png'
          }
        },
        {
          interval: 1000
        },
        (done1, recipe) => {
          workspace.build().then(() => {
            app.start(err => {
              if (err) return done(err)

              setTimeout(() => {
                request(cdnUrl)
                .get('/foobar-recipe-one/test.jpg')
                .set('host', 'testdomain.com:80')
                .expect(200)
                .end((err, res) => {
                  res.headers['content-type'].should.eql(
                    'image/png'
                  )

                  let newRecipe = Object.assign({}, recipe, {
                    settings: {
                      format: 'jpg'
                    }
                  })

                  fs.writeFileSync(
                    recipePath,
                    JSON.stringify(newRecipe, null, 2)
                  )

                  setTimeout(() => {
                    request(cdnUrl)
                      .get('/foobar-recipe-one/test.jpg')
                      .set('host', 'testdomain.com:80')
                      .expect(200)
                      .end((err, res) => {
                        res.headers['content-type'].should.eql(
                          'image/jpeg'
                        )

                        config.set('multiDomain.enabled', configBackup.multiDomain.enabled)
                        config.set('multiDomain.directory', configBackup.multiDomain.directory)

                        done1()

                        app.stop(done)
                      })
                  }, 500)
                })
              }, 500)
            })
          })
        }
      )
    }).timeout(5000)

    it('should reload a route when the file changes', done => {
      let mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 10_1 like Mac OS X) AppleWebKit/602.2.14 (KHTML, like Gecko) Version/10.0 Mobile/14B72 Safari/602.1'

      help.createTempFile(
        'workspace/recipes/test-recipe-one.json',
        {
          recipe: 'recipe-one',
          settings: {
            format: 'jpg'
          }
        },
        {
          interval: 1000
        },
        done1 => {
          help.createTempFile(
            'workspace/recipes/test-recipe-two.json',
            {
              recipe: 'recipe-two',
              settings: {
                format: 'png'
              }
            },
            {
              interval: 1000
            },
            done2 => {
              help.createTempFile(
                'workspace/routes/test-route-one.json',
                {
                  route: 'route-one',
                  branches: [
                    {
                      'condition': {
                        'device': 'mobile',
                      },
                      'recipe': 'recipe-one'
                    },
                    {
                      'recipe': 'recipe-two'
                    }
                  ]
                },
                {
                  interval: 1000
                },
                (done3, routeContent) => {
                  app.start(err => {
                    if (err) return done(err)

                    setTimeout(() => {
                      request(cdnUrl)
                      .get('/route-one/test.jpg')
                      .set('user-agent', mobileUA)
                      .expect(200)
                      .end((err, res) => {
                        res.headers['content-type'].should.eql(
                          'image/jpeg'
                        )

                        routeContent.branches[0].recipe = 'recipe-two'
                        routeContent.branches[1].recipe = 'recipe-one'

                        fs.writeFileSync(
                          path.resolve('workspace/routes/test-route-one.json'),
                          JSON.stringify(routeContent, null, 2)
                        )

                        setTimeout(() => {
                          request(cdnUrl)
                          .get('/route-one/test.jpg')
                          .set('user-agent', mobileUA)
                          .expect(200)
                          .end((err, res) => {
                            res.headers['content-type'].should.eql(
                              'image/png'
                            )

                            done3()
                            done2()
                            done1()
                            
                            app.stop(done)                            
                          })                          
                        }, 500)
                      })
                    }, 500)
                  })
                }
              )
            }
          )
        }
      )
    }).timeout(5000)

    it('should reload a route at domain level when the file changes', done => {
      let mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 10_1 like Mac OS X) AppleWebKit/602.2.14 (KHTML, like Gecko) Version/10.0 Mobile/14B72 Safari/602.1'

      config.set('multiDomain.enabled', true)
      config.set('multiDomain.directory', 'domains')

      help.createTempFile(
        'domains/testdomain.com/workspace/recipes/test-recipe-one.json',
        {
          recipe: 'recipe-one',
          settings: {
            format: 'jpg'
          }
        },
        {
          interval: 1000
        },
        done1 => {
          help.createTempFile(
            'domains/testdomain.com/workspace/recipes/test-recipe-two.json',
            {
              recipe: 'recipe-two',
              settings: {
                format: 'png'
              }
            },
            {
              interval: 1000
            },
            done2 => {
              help.createTempFile(
                'domains/testdomain.com/workspace/routes/test-route-one.json',
                {
                  route: 'route-one',
                  branches: [
                    {
                      'condition': {
                        'device': 'mobile',
                      },
                      'recipe': 'recipe-one'
                    },
                    {
                      'recipe': 'recipe-two'
                    }
                  ]
                },
                {
                  interval: 1000
                },
                (done3, routeContent) => {
                  app.start(err => {
                    if (err) return done(err)

                    setTimeout(() => {
                      request(cdnUrl)
                      .get('/route-one/test.jpg')
                      .set('host', 'testdomain.com:80')
                      .set('user-agent', mobileUA)
                      .expect(200)
                      .end((err, res) => {
                        res.headers['content-type'].should.eql(
                          'image/jpeg'
                        )

                        routeContent.branches[0].recipe = 'recipe-two'
                        routeContent.branches[1].recipe = 'recipe-one'

                        fs.writeFileSync(
                          path.resolve('domains/testdomain.com/workspace/routes/test-route-one.json'),
                          JSON.stringify(routeContent, null, 2)
                        )

                        setTimeout(() => {
                          request(cdnUrl)
                          .get('/route-one/test.jpg')
                          .set('host', 'testdomain.com:80')
                          .set('user-agent', mobileUA)
                          .expect(200)
                          .end((err, res) => {
                            res.headers['content-type'].should.eql(
                              'image/png'
                            )

                            config.set('multiDomain.enabled', configBackup.multiDomain.enabled)
                            config.set('multiDomain.directory', configBackup.multiDomain.directory)

                            done3()
                            done2()
                            done1()
                            
                            app.stop(done)                            
                          })                          
                        }, 500)
                      })
                    }, 500)
                  })
                }
              )
            }
          )
        }
      )
    }).timeout(5000)    
  })
})
